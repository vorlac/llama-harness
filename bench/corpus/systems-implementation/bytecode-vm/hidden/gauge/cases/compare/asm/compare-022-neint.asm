; case compare-022-neint
; expect exit=0 stdout="false\n"
.func main arity=0 locals=0
  PUSH_INT 42
  PUSH_INT 42
  NE
  PRINT
  RET
.end
