; case control-046-nestedloop
; expect exit=0 stdout="0,0\n0,1\n1,0\n1,1\n2,0\n2,1\n"
.func main arity=0 locals=2
  PUSH_INT 0
  STORE_LOCAL 0
i_top:
  LOAD_LOCAL 0
  PUSH_INT 3
  LT
  JMP_IF_FALSE i_end
  PUSH_INT 0
  STORE_LOCAL 1
j_top:
  LOAD_LOCAL 1
  PUSH_INT 2
  LT
  JMP_IF_FALSE j_end
  LOAD_LOCAL 0
  TOSTR
  PUSH_STR ","
  CONCAT
  LOAD_LOCAL 1
  TOSTR
  CONCAT
  PRINT
  LOAD_LOCAL 1
  PUSH_INT 1
  ADD
  STORE_LOCAL 1
  JMP j_top
j_end:
  LOAD_LOCAL 0
  PUSH_INT 1
  ADD
  STORE_LOCAL 0
  JMP i_top
i_end:
  RET
.end
