; case compare-041-leint
; expect exit=0 stdout="false\n"
.func main arity=0 locals=0
  PUSH_INT 1
  PUSH_INT -1
  LE
  PRINT
  RET
.end
