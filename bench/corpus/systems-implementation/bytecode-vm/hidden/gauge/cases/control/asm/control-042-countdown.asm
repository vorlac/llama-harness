; case control-042-countdown
; expect exit=0 stdout="5\n4\n3\n2\n1\nliftoff\n"
.func main arity=0 locals=1
  PUSH_INT 5
  STORE_LOCAL 0
loop:
  LOAD_LOCAL 0
  PUSH_INT 0
  GT
  JMP_IF_FALSE end
  LOAD_LOCAL 0
  PRINT
  LOAD_LOCAL 0
  PUSH_INT 1
  SUB
  STORE_LOCAL 0
  JMP loop
end:
  PUSH_STR "liftoff"
  PRINT
  RET
.end
