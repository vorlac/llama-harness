; case compare-049-gtint
; expect exit=0 stdout="false\n"
.func main arity=0 locals=0
  PUSH_INT 0
  PUSH_INT 0
  GT
  PRINT
  RET
.end
