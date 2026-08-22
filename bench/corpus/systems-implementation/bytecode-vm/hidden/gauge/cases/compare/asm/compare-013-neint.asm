; case compare-013-neint
; expect exit=0 stdout="false\n"
.func main arity=0 locals=0
  PUSH_INT 0
  PUSH_INT 0
  NE
  PRINT
  RET
.end
